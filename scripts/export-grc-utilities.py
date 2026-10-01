#!/usr/bin/env python3
"""Export Gympie Regional Council public utility layers from its WFS service."""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import shapefile
from pyproj import CRS, Transformer


SERVICE_URL = (
    "https://gympie.spatial.t1cloud.com/spatial/OWS/gympie/Infrastructure_WMS"
)
SOURCE_CRS = "EPSG:7856"
WEB_CRS = "EPSG:4326"
PAGE_SIZE = 2000

LAYERS = {
    "water": [
        "WaterPipes",
        "WaterStorage",
        "WaterTreatmentPlants",
        "WaterBoosterPumps",
        "WaterBores",
        "WaterFittings",
        "Water Stand Pipes",
    ],
    "sewer": [
        "SewerReticulation",
        "SewerConnections",
        "SewerChambers",
        "SewerTreatmentPlants",
        "SewerPumpStations",
    ],
    "stormwater": [
        "StormwaterPipes",
        "InteralotmentPipes",
        "StormwaterPits",
        "InteralotmentPits",
    ],
}


def request_bytes(params: dict[str, object], attempts: int = 4) -> bytes:
    query = urllib.parse.urlencode(params)
    url = f"{SERVICE_URL}?{query}"
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "Accept": "application/json, application/xml, text/xml;q=0.9, */*;q=0.1",
                    "User-Agent": "GRC-utilities-public-data-export/1.0",
                },
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except Exception as exc:  # pragma: no cover - network retry path
            last_error = exc
            if attempt < attempts:
                time.sleep(attempt * 2)
    raise RuntimeError(f"Request failed after {attempts} attempts: {url}") from last_error


def expected_count(layer: str) -> int:
    payload = request_bytes(
        {
            "SERVICE": "WFS",
            "VERSION": "2.0.0",
            "REQUEST": "GetFeature",
            "TYPENAMES": layer,
            "RESULTTYPE": "hits",
        }
    )
    root = ET.fromstring(payload)
    value = root.attrib.get("numberMatched")
    if value is None or value == "unknown":
        raise RuntimeError(f"The WFS did not provide a feature count for {layer}")
    return int(value)


def download_layer(layer: str, total: int) -> dict[str, object]:
    features: list[dict[str, object]] = []
    start_index = 0
    while start_index < total:
        payload = request_bytes(
            {
                "SERVICE": "WFS",
                "VERSION": "2.0.0",
                "REQUEST": "GetFeature",
                "TYPENAMES": layer,
                "STARTINDEX": start_index,
                "COUNT": min(PAGE_SIZE, total - start_index),
                "OUTPUTFORMAT": "geojson",
            }
        )
        try:
            page = json.loads(payload)
        except json.JSONDecodeError as exc:
            preview = payload[:500].decode("utf-8", errors="replace")
            raise RuntimeError(f"Non-GeoJSON response for {layer}: {preview}") from exc

        page_features = page.get("features", [])
        if not page_features:
            break
        features.extend(page_features)
        start_index += len(page_features)
        print(f"  {layer}: {len(features)}/{total}", flush=True)

    if len(features) != total:
        raise RuntimeError(
            f"Feature-count mismatch for {layer}: expected {total}, received {len(features)}"
        )

    return {
        "type": "FeatureCollection",
        "name": layer,
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:EPSG::7856"},
        },
        "features": features,
    }


def safe_file_name(layer: str) -> str:
    value = re.sub(r"(?<!^)(?=[A-Z])", "_", layer).replace(" ", "_")
    return re.sub(r"_+", "_", value).strip("_").lower()


def write_geojson(path: Path, collection: dict[str, object]) -> None:
    path.write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def transform_coordinates(value: object, transformer: Transformer) -> object:
    if not isinstance(value, list) or not value:
        return value
    if isinstance(value[0], (int, float)):
        x, y = transformer.transform(value[0], value[1])
        return [x, y, *value[2:]]
    return [transform_coordinates(item, transformer) for item in value]


def to_web_geojson(
    collection: dict[str, object], transformer: Transformer
) -> dict[str, object]:
    output = {
        "type": "FeatureCollection",
        "name": collection["name"],
        "features": [],
    }
    for feature in collection["features"]:
        copied = {
            "type": "Feature",
            "properties": feature.get("properties", {}),
            "geometry": None,
        }
        geometry = feature.get("geometry")
        if geometry:
            copied["geometry"] = {
                "type": geometry["type"],
                "coordinates": transform_coordinates(
                    geometry.get("coordinates"), transformer
                ),
            }
        if "id" in feature:
            copied["id"] = feature["id"]
        output["features"].append(copied)
    return output


def shapefile_type(collection: dict[str, object]) -> int:
    for feature in collection["features"]:
        geometry = feature.get("geometry")
        if not geometry:
            continue
        geometry_type = geometry.get("type", "").upper()
        if geometry_type == "POINT":
            return shapefile.POINT
        if geometry_type == "MULTIPOINT":
            return shapefile.MULTIPOINT
        if geometry_type in {"LINESTRING", "MULTILINESTRING"}:
            return shapefile.POLYLINE
        if geometry_type in {"POLYGON", "MULTIPOLYGON"}:
            return shapefile.POLYGON
        raise RuntimeError(f"Unsupported geometry type: {geometry_type}")
    raise RuntimeError(f"No geometry found in {collection['name']}")


def short_field_names(field_names: list[str]) -> dict[str, str]:
    used: set[str] = set()
    mapping: dict[str, str] = {}
    for original in field_names:
        base = re.sub(r"[^A-Za-z0-9_]", "_", original).upper() or "FIELD"
        candidate = base[:10]
        suffix = 1
        while candidate in used:
            suffix_text = str(suffix)
            candidate = f"{base[: 10 - len(suffix_text)]}{suffix_text}"
            suffix += 1
        used.add(candidate)
        mapping[original] = candidate
    return mapping


def write_shapefile(
    path: Path, collection: dict[str, object], projection_wkt: str
) -> dict[str, str]:
    properties = [feature.get("properties", {}) for feature in collection["features"]]
    field_names = list(dict.fromkeys(key for item in properties for key in item.keys()))
    synthetic_id = not field_names
    if synthetic_id:
        field_names = ["feature_id"]
    field_mapping = short_field_names(field_names)

    with shapefile.Writer(str(path), shapeType=shapefile_type(collection)) as writer:
        writer.autoBalance = 1
        for original in field_names:
            writer.field(field_mapping[original], "C", size=254)
        for feature_index, feature in enumerate(collection["features"], start=1):
            geometry = feature.get("geometry")
            if geometry:
                writer.shape(geometry)
            else:
                writer.null()
            values = []
            feature_properties = feature.get("properties", {})
            for field_name in field_names:
                if synthetic_id and field_name == "feature_id":
                    value = feature.get("id", feature_index)
                else:
                    value = feature_properties.get(field_name)
                if value is None:
                    text = ""
                elif isinstance(value, (dict, list)):
                    text = json.dumps(value, ensure_ascii=False)
                else:
                    text = str(value)
                values.append(text[:254])
            writer.record(*values)

    path.with_suffix(".prj").write_text(projection_wkt, encoding="utf-8")
    path.with_suffix(".cpg").write_text("UTF-8", encoding="ascii")
    return field_mapping


def write_field_mapping(path: Path, mapping: dict[str, str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["source_field", "shapefile_field"])
        writer.writerows(mapping.items())


def write_readme(output: Path, counts: dict[str, dict[str, int]], generated: str) -> None:
    lines = [
        "Gympie Regional Council public utilities data export",
        "====================================================",
        "",
        f"Generated: {generated}",
        f"Source WFS: {SERVICE_URL}",
        "Source service: Gympie Regional Council Buried Infrastructure",
        "",
        "Contents",
        "--------",
        "GeoJSON_GDA2020_MGA56: original Council coordinates (EPSG:7856).",
        "GeoJSON_WGS84: longitude/latitude copies (EPSG:4326) for web mapping.",
        "Shapefiles_GDA2020_MGA56: ESRI shapefiles in EPSG:7856.",
        "Metadata: per-layer field-name mappings used by the shapefiles.",
        "",
        "Feature counts at export",
        "------------------------",
    ]
    for category, category_counts in counts.items():
        lines.append(category.title())
        for layer, count in category_counts.items():
            lines.append(f"  {layer}: {count}")
    lines.extend(
        [
            "",
            "Important",
            "---------",
            "This is a point-in-time copy of Council's public mapping data.",
            "Locations may be incomplete or approximate. Confirm underground services with",
            "Council and Before You Dig Australia before excavation, design or construction.",
            "GeoJSON preserves the original attribute names. Shapefile field names are limited",
            "to 10 characters; see the corresponding CSV files in Metadata.",
            "",
        ]
    )
    (output / "README.txt").write_text("\n".join(lines), encoding="utf-8")


def completed_layer_files(
    native_path: Path,
    web_path: Path,
    shape_path: Path,
    field_map_path: Path,
    expected: int,
) -> bool:
    required = [
        native_path,
        web_path,
        shape_path.with_suffix(".shp"),
        shape_path.with_suffix(".shx"),
        shape_path.with_suffix(".dbf"),
        shape_path.with_suffix(".prj"),
        shape_path.with_suffix(".cpg"),
        field_map_path,
    ]
    if not all(path.is_file() and path.stat().st_size > 0 for path in required):
        return False
    try:
        with native_path.open("r", encoding="utf-8") as handle:
            native_count = len(json.load(handle).get("features", []))
        with web_path.open("r", encoding="utf-8") as handle:
            web_count = len(json.load(handle).get("features", []))
        shape_count = len(shapefile.Reader(str(shape_path)))
    except (OSError, ValueError, json.JSONDecodeError, shapefile.ShapefileException):
        return False
    return native_count == web_count == shape_count == expected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    output = args.output.resolve()
    if output.exists() and not args.resume:
        raise SystemExit(f"Refusing to overwrite existing output: {output}")

    native_root = output / "GeoJSON_GDA2020_MGA56"
    web_root = output / "GeoJSON_WGS84"
    shape_root = output / "Shapefiles_GDA2020_MGA56"
    metadata_root = output / "Metadata"
    for category in LAYERS:
        (native_root / category).mkdir(parents=True, exist_ok=True)
        (web_root / category).mkdir(parents=True, exist_ok=True)
        (shape_root / category).mkdir(parents=True, exist_ok=True)
        (metadata_root / category).mkdir(parents=True, exist_ok=True)

    transformer = Transformer.from_crs(SOURCE_CRS, WEB_CRS, always_xy=True)
    projection_wkt = CRS.from_epsg(7856).to_wkt(version="WKT1_ESRI")
    counts: dict[str, dict[str, int]] = {}

    for category, layers in LAYERS.items():
        counts[category] = {}
        for layer in layers:
            print(f"Downloading {category}/{layer}", flush=True)
            total = expected_count(layer)
            counts[category][layer] = total
            file_name = safe_file_name(layer)

            native_path = native_root / category / f"{file_name}.geojson"
            web_path = web_root / category / f"{file_name}.geojson"
            shape_path = shape_root / category / file_name
            field_map_path = metadata_root / category / f"{file_name}_fields.csv"
            if args.resume and completed_layer_files(
                native_path,
                web_path,
                shape_path,
                field_map_path,
                total,
            ):
                print(f"  {layer}: reusing complete export ({total})", flush=True)
                continue

            collection = download_layer(layer, total)

            write_geojson(native_path, collection)
            web_collection = to_web_geojson(collection, transformer)
            write_geojson(web_path, web_collection)

            field_mapping = write_shapefile(
                shape_path, collection, projection_wkt
            )
            write_field_mapping(field_map_path, field_mapping)

    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    write_readme(output, counts, generated)
    metadata = {
        "generated": generated,
        "source": SERVICE_URL,
        "source_crs": SOURCE_CRS,
        "web_geojson_crs": WEB_CRS,
        "layers": counts,
    }
    (output / "Metadata" / "export.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )

    archive = shutil.make_archive(str(output), "zip", output.parent, output.name)
    print(f"Created {archive}", flush=True)


if __name__ == "__main__":
    main()
