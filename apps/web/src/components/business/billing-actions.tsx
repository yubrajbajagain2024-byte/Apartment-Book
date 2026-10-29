"use client";

import { Download, Printer } from "lucide-react";
import { bizButton } from "./ui";

/** Saves the payments as a CSV file (built on the server by paymentsCsv), named after the business and the day. */
export function DownloadCsv({ csv, filename }: { csv: string; filename: string }) {
  function save() {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <button type="button" onClick={save} className={bizButton({ variant: "secondary" })}>
      <Download className="h-4 w-4" /> Download CSV
    </button>
  );
}

/** Prints the receipt (or saves it as a PDF from the print dialog); the portal's sidebar stays off the page. */
export function PrintReceipt() {
  return (
    <button type="button" onClick={() => window.print()} className={bizButton({ variant: "primary" })}>
      <Printer className="h-4 w-4" /> Print or save as PDF
    </button>
  );
}
