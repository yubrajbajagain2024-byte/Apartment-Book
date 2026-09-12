import type { Metadata } from "next";
import { LegalPage } from "@/components/common/legal-page";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="September 2026">
      <h2>What we collect</h2>
      <p>Your name, university email address, the profile details you choose to add (photo, program, bio), the listings, posts, comments and messages you create, and basic device information such as a push notification token if you allow notifications.</p>
      <p>Photos and videos you upload are stored as you provide them. Location data in photos (EXIF) is not used to place your listing; a listing only has a map location when you set one.</p>
      <h2>How we use it</h2>
      <p>To run Apartment Book: show your posts to other students, deliver your messages, count views and messages on your own listings, show who is online (you can turn this off in Settings), and send notifications you have opted into.</p>
      <p>We do not sell your data and we do not show advertising.</p>
      <h2>Who can see what</h2>
      <p>Listings, roommate posts, marketplace items, comments and your public profile are visible to everyone who uses the app. Messages are visible only to the members of the conversation. Reports you file are visible only to the team.</p>
      <h2>Where it lives</h2>
      <p>Data is stored with Supabase (database, authentication and file storage) and videos are processed and streamed by Mux. The website is hosted on Vercel.</p>
      <h2>Your choices</h2>
      <p>You can edit your profile, hide your active status, delete any post, block people and delete your account at any time from Settings. Deleting your account removes your profile, posts, comments, messages and saved items.</p>
      <h2>Contact</h2>
      <p>Questions about privacy: email the team at the address shown on the app store listing.</p>
    </LegalPage>
  );
}
