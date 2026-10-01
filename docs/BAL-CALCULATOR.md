# Bushfire Attack Level calculator

The shared council-map calculator provides a preliminary Bushfire Attack Level (BAL) for each vegetation exposure around a selected lot. It saves one result for each compass direction and reports the highest saved BAL as the overall result.

## Method

The implementation follows the detailed radiant-heat sequence in Appendix B of AS 3959:2018 (including Amendments 1 and 2):

1. Select the fire-spread model and nominal fuel values for the AS 3959 vegetation classification.
2. Adjust the rate of spread for the effective slope beneath the vegetation.
3. Calculate fireline intensity and flame length.
4. Find the flame angle and receiver elevation producing the maximum geometric view factor.
5. Calculate atmospheric transmissivity and flame emissive power.
6. Calculate incident radiant heat with `q = transmissivity × view factor × flame emissive power`.
7. Assign BAL-12.5, BAL-19, BAL-29, BAL-40 or BAL-FZ from the radiant-heat thresholds. BAL-Low is only returned when a confirmed exclusion/low-threat condition is selected or classified vegetation is more than 100 m away.

The advanced fields allow an assessor to replace nominal fuel loads, vegetation height, wind/GFDI and flame width with supported site-specific inputs. For Queensland planning work, use the relevant site-specific FFDI and Vegetation Hazard Class fuel data where required by the applicable assessment process.

## Important limitations

- A bushfire overlay intersection does not itself establish a BAL.
- Distance is the horizontal distance from the proposed building (not merely the lot boundary) to the classified vegetation edge.
- Effective slope is the slope beneath the classified vegetation; it is not the average lot slope.
- Every relevant vegetation direction must be assessed and the highest BAL governs.
- Low-threat vegetation and exclusions require field verification.
- Results are preliminary and do not replace a site inspection, a report by a competent bushfire practitioner, building certification, the current NCC, AS 3959, planning-scheme provisions or approval conditions.

Queensland reference: [Bushfire Resilient Communities](https://www.fire.qld.gov.au/compliance-and-planning/bushfire-planning/brc).
