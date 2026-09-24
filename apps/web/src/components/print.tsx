"use client";

import { Button } from "./ui";

/** Print and "Download PDF" both go through the browser's print dialog; the print stylesheet does the rest. */
export function PrintButtons() {
  return (
    <div className="flex gap-2 no-print">
      <Button kind="secondary" size="sm" onClick={() => window.print()}>
        Print
      </Button>
      <Button size="sm" onClick={() => window.print()} title="Choose “Save as PDF” in the print dialog">
        Download PDF
      </Button>
    </div>
  );
}
