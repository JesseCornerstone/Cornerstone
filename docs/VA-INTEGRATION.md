# Lot Companion Visual Approvals Integration

This document describes the backend API contract for connecting Visual Approvals (VA) to Lot Companion.

## Current report capability

The integration service provides:

- API-key authentication
- Direct, one-call PDF generation for external programs
- Request/status/download endpoints
- Request metadata storage
- Branded, multi-page council property report output
- JSON summary output
- Manual-review fallback
- Admin report list

The report-only backend launches an invisible local Edge or Chrome session and
runs the same council map, parcel lookup, overlay queries, screenshots, and
branded report composer used by the visible mapping interface. A successful,
high-confidence request returns `complete`; `manual_review` is retained for a
completed report whose council detection is low confidence.

## Report-only service

### Cornerstone Application Intake / report-only service

Cornerstone Application Intake can point its `Lot Companion program folder`
setting at this project directory. It detects and launches
`va-report-server.js`, which exposes the health and authenticated report
endpoints plus a loopback-only static route used by its invisible report
renderer. It does not expose the normal interactive entry page, SQL
authentication, Stripe, or the other web application routes.

During conversion the Outlook program:

1. starts the report-only server on an available loopback port;
2. supplies a temporary API key and temporary storage directory;
3. submits the extracted address, lot/plan, council, and building type;
4. downloads the generated PDF into the job's `Property Information` folder;
5. adds the PDF to the Visual Approvals attachments array; and
6. stops the report-only server.

The server binds to `127.0.0.1` by default, so other computers cannot reach the
temporary converter instance. A separately hosted integration should use HTTPS,
set a long-lived `VA_API_KEYS` value, and configure the converter's API URL and
key instead.

To run the report-only service manually:

```powershell
$env:VA_API_KEYS='replace_with_long_random_key'
$env:VA_REQUIRE_HTTPS='false' # local loopback testing only
npm run serve:reports
```

## Authentication

Set one or more keys in the server environment:

```env
VA_API_KEYS=replace_with_long_random_key
VA_REQUIRE_HTTPS=true
VA_STORAGE_DIR=storage
```

Send the key with each VA API request:

```http
x-api-key: replace_with_long_random_key
```

Bearer auth is also accepted:

```http
Authorization: Bearer replace_with_long_random_key
```

If no key is configured, `/api/va/*` returns `503` and will not process requests.

## Endpoints

### Generate and download in one call (no UI)

Use this endpoint when an external program wants the generated document in the
same HTTP response and does not need to manage status polling:

```http
POST /api/va/report-generate
Content-Type: application/json
Accept: application/pdf
x-api-key: replace_with_long_random_key
```

The JSON body uses the same fields and aliases as `report-request` below. A
successful response is the PDF file itself (`Content-Type: application/pdf`).
The following response headers allow the caller to record the job:

- `X-Lot-Wise-Request-Id`
- `X-Lot-Wise-Report-Status` (`complete` or `manual_review`)
- `X-Lot-Wise-Manual-Review` (`true` or `false`)

The generated request is also persisted, so its summary and audit history can
be retrieved later using the returned request ID. Add
`?disposition=inline` if the caller wants inline display instead of an
attachment download.

PowerShell example:

```powershell
$headers = @{
  'x-api-key' = 'replace_with_configured_key'
  'Accept' = 'application/pdf'
}
$body = @{
  jobNumber = 'CBC-2026-001'
  address = '266 George Street, Brisbane QLD 4000'
  lotPlan = '1/RP12345'
  council = 'Brisbane City Council'
} | ConvertTo-Json

Invoke-WebRequest `
  -Method Post `
  -Uri 'https://your-host.example.com/api/va/report-generate' `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $body `
  -OutFile '.\CBC-2026-001-lot-companion.pdf'
```

JavaScript/Node example:

```js
const response = await fetch(`${baseUrl}/api/va/report-generate`, {
  method: 'POST',
  headers: {
    'x-api-key': apiKey,
    'content-type': 'application/json',
    accept: 'application/pdf'
  },
  body: JSON.stringify({
    jobNumber: 'CBC-2026-001',
    address: '266 George Street, Brisbane QLD 4000',
    lotPlan: '1/RP12345',
    council: 'Brisbane City Council'
  })
});

if (!response.ok) throw new Error(await response.text());
const requestId = response.headers.get('x-lot-wise-request-id');
const pdf = Buffer.from(await response.arrayBuffer());
```

### Create report request

```http
POST /api/va/report-request
Content-Type: application/json
x-api-key: replace_with_long_random_key
```

Sample body:

```json
{
  "vaJobId": "VA-12345",
  "jobNumber": "CBC-2026-001",
  "address": "266 George Street, Brisbane QLD 4000",
  "lotPlan": "1/RP12345",
  "council": "Brisbane City Council",
  "applicationType": "Building Approval"
}
```

Accepted aliases include `jobId`, `jobNo`, `propertyAddress`, `siteAddress`, `realPropertyDescription`, `localGovernmentArea`, `lga`, `application`, and `approvalType`.

Sample response:

```json
{
  "ok": true,
  "accepted": true,
  "requestId": "7a9c4e9e-2b9d-4d3f-a4c1-1bb72f2efc2a",
  "status": "pending",
  "links": {
    "status": "https://example.com/api/va/report-status/7a9c4e9e-2b9d-4d3f-a4c1-1bb72f2efc2a",
    "summary": "https://example.com/api/va/report-summary/7a9c4e9e-2b9d-4d3f-a4c1-1bb72f2efc2a",
    "download": "https://example.com/api/va/report-download/7a9c4e9e-2b9d-4d3f-a4c1-1bb72f2efc2a"
  }
}
```

### Check report status

```http
GET /api/va/report-status/:requestId
x-api-key: replace_with_long_random_key
```

Statuses:

- `pending`
- `running`
- `complete`
- `failed`
- `manual_review`

While a request is running, the response also includes `phase` and
`parcelFound`. The discovery timeout applies only while `parcelFound` is false.
Once the parcel is located, `parcelFound` becomes true and report generation
continues until the complete PDF is available. A parcel that cannot be located
returns `failed` with `errorCode: "parcel_not_found"`; clients may skip only
that specific outcome.

Sample `complete` response:

```json
{
  "ok": true,
  "requestId": "7a9c4e9e-2b9d-4d3f-a4c1-1bb72f2efc2a",
  "status": "complete",
  "manualReview": false,
  "manualReviewReasons": [],
  "report": {
    "fileName": "CBC-2026-001-lot-companion-property-report.pdf",
    "contentType": "application/pdf"
  }
}
```

### Get JSON summary

```http
GET /api/va/report-summary/:requestId
x-api-key: replace_with_long_random_key
```

The summary includes the detected council, the report's mapped section titles,
page count, report title, key flags, and any manual-review reasons.

### Download report

```http
GET /api/va/report-download/:requestId
x-api-key: replace_with_long_random_key
```

Returns the generated PDF when status is `complete` or `manual_review`.

If the report is still `pending` or `running`, the endpoint returns `409`.

### Admin list

```http
GET /api/va/admin/reports?status=manual_review&limit=100
x-api-key: replace_with_long_random_key
```

The browser admin page is available at:

```text
/VAAdmin.html
```

## Manual-review triggers

The system returns `manual_review` when the completed report was generated but its
council detection was low confidence. A missing lot/plan, an undetected council,
a parcel that cannot be located, a mapping-source failure, or a browser-rendering
failure returns `failed` instead of substituting a workflow-status PDF.

## VA questions to confirm

Confirm whether VA can:

- trigger an external API call when a job is created or updated
- send address, lot/plan, council, job number, and application type
- store `requestId` against the VA job
- poll a status endpoint or receive a webhook later
- download a generated PDF from a secure URL
- upload the returned PDF into the VA job document area
- store the JSON summary as notes, flags, or structured job metadata

## Production hardening priorities

1. Replace local report storage with managed encrypted document storage.
2. Add request expiry, retention, and audit-log policies.
3. Add webhooks or direct document upload when Visual Approvals exposes the
   required API contract.
4. Add hosted-service monitoring, structured logs, and operational alerts.
5. Complete security and load testing before exposing the service publicly.
