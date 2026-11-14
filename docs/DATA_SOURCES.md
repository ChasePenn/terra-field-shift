# Data sources

Paste this list into the "Space agency data" and "References" fields of the project page.

## NASA data

| Dataset | What Terra uses it for | Access |
|---|---|---|
| NASA POWER, daily point data (T2M_MAX, T2M_MIN, PRECTOTCORR, GWETROOT), crop years 2005 to 2024 | Heat days, freezes, rain, and daily crop water demand for every rotation and every past year | https://power.larc.nasa.gov/ (API, live in browser) |
| MODIS Terra/Aqua MOD13Q1 NDVI, 250 m, 16-day | Greenness history at the field and likely bare periods | ORNL DAAC MODIS web service, https://modis.ornl.gov/data/modis_webservice.html |
| MODIS Terra NDVI 8-day (GIBS layer MODIS_Terra_NDVI_8Day) | Greenness map layer | NASA GIBS WMS, https://nasa-gibs.github.io/gibs-api-docs/ |
| SMAP Level 4 root-zone soil moisture (GIBS layer SMAP_L4_Analyzed_Root_Zone_Soil_Moisture) | Soil moisture map layer | NASA GIBS WMS |
| NASA POWER, last 90 days | This season's rain and heat compared with the same weeks in 2005 to 2024 | https://power.larc.nasa.gov/ |
| GRACE and GRACE-FO JPL mascon water storage change (GIBS layer GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI_v6_STD) | Groundwater and total water storage change map layer | NASA GIBS WMS |

## Other data and references

- ISRIC SoilGrids 2.0 (250 m): topsoil sand, silt, clay and organic carbon at the field. https://soilgrids.org/

- FAO Irrigation and Drainage Paper 56 (Allen et al., 1998): crop coefficients, stage lengths, Hargreaves equation, dry-climate Kc adjustment. https://www.fao.org/4/x0490e/x0490e0b.htm
- University of Arizona, Planting Dates for Small Grains in Arizona (AZ1332). https://extension.arizona.edu/sites/extension.arizona.edu/files/pubs/az1332-2015.pdf
- University of Arizona, Irrigation of Small Grains in Arizona (AZ1345). https://itc.tamu.edu/files/2023/08/az1345-2015.pdf
- University of Arizona, cotton planting and harvest timing. https://cales.arizona.edu/news/why-do-we-grow-cotton-arizona
- Erie et al., Arizona cotton consumptive use (~41 in). https://icac.org/wp-content/uploads/2024/11/1991-March-Cotton-Recorder.pdf
- University of Arizona ACIS, sorghum water use near Phoenix (25 in). https://acis.cals.arizona.edu/agricultural-ipm/field-crop/corn-and-sorghum/irrigation
- University of Arizona repository, alfalfa water requirement (~6 acre-feet). https://repository.arizona.edu/handle/10150/201439
- Alexander, Bucks and Backhaus (1988), Irrigation Water Management for Guar Seed Production, Maricopa AZ. https://agris.fao.org/search/en/records/65df7b474c5aef494fe2db02
- University of Arizona SBAR, Guar as a Rotation Crop. https://sbar.arizona.edu/sites/default/files/2023-04/SBAR%20Fact%20Sheet%20Guar%20as%20a%20Rotation%20Crop.pdf
- University of Arizona, water sustainability indicators for small grains (statewide average ~4.12 acre-feet per acre applied). https://extension.arizona.edu/publication/water-sustainability-indicators-arizonas-small-grains-industry
- University of Arizona, Pinal County 2025 field crop budgets. https://repository.arizona.edu/handle/10150/678680
- Map imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics). Map library: MapLibre GL JS.

## Ideas credited to other teams

We read other public Field Shift projects for ideas and wrote all of our own code. The year-by-year replay against past weather was inspired by FieldShift (github.com/samuelakosaonyejekwe/fieldshift). The 12-month calendar strip and evidence-based confidence labels were inspired by Mekong Rotation Explorer (github.com/kp712/luclonghoi).
