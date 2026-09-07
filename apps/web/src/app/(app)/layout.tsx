import { Navbar } from "@/components/layout/navbar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 pb-24 pt-4 sm:px-4 md:pb-8">{children}</main>
    </>
  );
}
