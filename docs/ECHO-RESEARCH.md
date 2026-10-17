# Echo Studio research and scope

Reviewed 2026-10-17 against the society sources below. This is an educational
reference and arithmetic tool, not an automated echo report or HFpEF diagnosis.

- [ASE diastolic function, 2025](https://www.asecho.org/guideline/left-ventricular-diastolic-function-by-echo/)
  supersedes the 2016 document. The former four-variable vote has been removed
  from the HFpEF teaching page. Contextual interpretation replaces misleading
  universal normal ranges for annular velocities and pressure-related indices.
  The [full guideline](https://www.asecho.org/wp-content/uploads/2025/07/Left-Ventricular-Diastolic-Function.pdf)
  distinguishes diagnosis of dysfunction (Figure 2) from filling-pressure
  estimation (Figure 3). Displayed thresholds explicitly name the figure;
  the app does not implement either algorithm as a diagnostic calculator.
- [ASE right heart, 2025](https://www.asecho.org/guideline/right-heart-in-adults-pulmonary-hypertension/)
  supports comprehensive assessment. The UI explains the assumptions behind
  IVC-based pressure and the difference between RV and PA pressure when there
  is outflow obstruction. A missing TR envelope is not a negative PH test.
- [ASE reporting, 2025](https://www.asecho.org/guideline/guidelines-for-the-standardization-of-adult-echocardiography-reporting/)
  informed clearer units, acquisition context and explicit interpretation limits.
- [ASE artifact guidance announcement, 2026](https://www.asecho.org/news/ase-publishes-guideline-document-dedicated-to-cardiac-ultrasound-artifacts/)
  informed the acquisition-quality reminder. No society diagrams or tables are
  reproduced; the app contains original short summaries and publisher links.
- [W3C tab pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
  informed manual keyboard activation, arrow focus movement, panel associations
  and focus retention after rendering.

Calculator groups and responsive presentation are implementation choices based
on these needs. Valve bands retain their named ACC/AHA and ASE editions; this
work does not claim that all reference data have been replaced with one latest
clinical model. Source documents require connectivity; summaries and arithmetic
remain available offline. Clinical review is still needed before patient-care use.

Regression evidence is generated in the ignored private-validation directory.
The new input-domain checks were observed failing with the old core restored;
the grouped fields, contextual interpretation, warning and source-rendering
checks failed with the old UI restored. Reversing a numerical range and removing
a range each failed the corresponding data-contract check. Restoring the old
navigation failed keyboard behavior, and removing group markup failed the
phone-layout check. Sources were restored before final validation.
