import type { Metadata } from "next";
import { LegalPage } from "@/components/common/legal-page";

export const metadata: Metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="September 2026">
      <h2>Who can use Apartment Book</h2>
      <p>Apartment Book is for university students. You need a verified university email address to create an account, and you must be at least 18 years old.</p>
      <h2>Your content</h2>
      <p>You own what you post. By posting, you give us permission to show it to other users of the app and website. Only post listings, items and photos that are yours to post, and keep descriptions honest.</p>
      <h2>Community rules</h2>
      <p>No scams, no harassment, no discrimination, no spam, and nothing illegal or sexually explicit. We may remove content and suspend accounts that break these rules. Use the Report option on any post, comment, message or profile, and Block to stop someone contacting you.</p>
      <h2>Payments and deals</h2>
      <p>Apartment Book does not handle payments and is not a party to any rental agreement or sale. Meet in public places, inspect before you pay, and never send money before seeing a place.</p>
      <h2>Your account</h2>
      <p>Keep your password private. You can delete your account at any time from Settings, which permanently removes your data.</p>
      <h2>Liability</h2>
      <p>The service is provided as is. We are not responsible for the accuracy of listings or the conduct of other users.</p>
    </LegalPage>
  );
}
