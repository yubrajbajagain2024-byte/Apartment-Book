"use client";

import { Download } from "lucide-react";
import { toCsv, type CsvValue } from "@apartment-book/shared";
import { buttonClasses } from "@/components/ui/button";

/** Downloads what the page shows as a CSV file (built in the browser from the page's own numbers; no extra request). */
export function CsvButton({ filename, header, rows, label = "Download CSV" }: { filename: string; header: string[]; rows: CsvValue[][]; label?: string }) {
  const download = () => {
    const blob = new Blob([toCsv(header, rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <button type="button" onClick={download} disabled={rows.length === 0} className={buttonClasses({ variant: "outline", size: "sm" })}>
      <Download className="h-4 w-4" aria-hidden /> {label}
    </button>
  );
}
