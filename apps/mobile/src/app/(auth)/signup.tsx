import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { createSignUpSchema, getAllowedEmailDomains } from "@apartment-book/shared";
import { Button, Field, Screen } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { SITE_URL, supabase } from "@/lib/supabase";
import { space, type } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";

/** Joining: the same welcome as the login, with three eyebrow-labelled fields, the ink button, the small print and a quiet link back. */
export default function SignupScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { data: domains } = useQuery(() => getAllowedEmailDomains(supabase).catch(() => [] as string[]), []);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = createSignUpSchema(domains ?? []).safeParse({ fullName, email, password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check your details");
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { full_name: parsed.data.fullName }, emailRedirectTo: `${SITE_URL}/auth/callback?next=/` },
    });
    setBusy(false);
    if (err) return setError(/database error saving new user/i.test(err.message) ? "Only verified university email addresses can join. Use your @txstate.edu email." : err.message);
    if (data.user && data.user.identities?.length === 0) return setError("An account with this email already exists. Try logging in.");
    // Close only this modal: the screen underneath re-renders signed in.
    if (data.session) return router.canGoBack() ? router.back() : router.replace("/(tabs)");
    setDone(true);
  }

  if (done) {
    return (
      <Screen>
        <View style={styles.done}>
          <Text style={styles.doneTitle} accessibilityRole="header">
            Check your email
          </Text>
          <Text style={styles.doneBody}>We sent a confirmation link to {email}. Open it, then come back and log in.</Text>
          <Button title="Go to log in" onPress={() => router.replace("/(auth)/login")} style={styles.submit} />
        </View>
      </Screen>
    );
  }
  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.form}>
        <View style={styles.welcome}>
          <Text style={styles.headline} accessibilityRole="header">
            Create your account
          </Text>
          <Text style={styles.tagline}>Students only: sign up with your {domains?.length ? domains.map((d) => `@${d}`).join(" or ") : "university"} email.</Text>
        </View>
        <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" textContentType="name" placeholder="Maya Torres" />
        <Field label="University email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@txstate.edu" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="At least 8 characters" onSubmitEditing={submit} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Create account" onPress={submit} loading={busy} style={styles.submit} />
        <Text style={styles.terms}>
          By joining you agree to our{" "}
          <Text style={styles.termsLink} onPress={() => void Linking.openURL(`${SITE_URL}/terms`)}>
            Terms
          </Text>{" "}
          and{" "}
          <Text style={styles.termsLink} onPress={() => void Linking.openURL(`${SITE_URL}/privacy`)}>
            Privacy policy
          </Text>
          .
        </Text>
        <Pressable onPress={() => router.replace("/(auth)/login")} hitSlop={8} accessibilityRole="button" style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
          <Text style={styles.linkText}>Already have an account? Log in</Text>
        </Pressable>
        <View style={{ height: space.xl }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  form: { gap: space.lg, paddingTop: space.md },
  welcome: { gap: space.sm, paddingTop: space.lg, paddingBottom: space.sm },
  headline: { ...type.display, color: colors.text },
  tagline: { ...type.aside, color: colors.muted },
  error: { ...type.caption, fontSize: 14, color: colors.red, marginLeft: 2 },
  submit: { marginTop: space.xs },
  terms: { ...type.footnote, color: colors.muted, textAlign: "center", paddingHorizontal: space.lg },
  termsLink: { color: colors.brand, fontWeight: "600" },
  link: { alignSelf: "center", paddingVertical: space.xs, paddingHorizontal: space.sm },
  pressed: { opacity: 0.7 },
  linkText: { ...type.label, fontSize: 15, color: colors.brand, textAlign: "center" },
  // Once the email is sent: the serif title, a line of body and the way to the login.
  done: { gap: space.md, paddingTop: space.xl },
  doneTitle: { ...type.title, color: colors.text },
  doneBody: { ...type.body, color: colors.muted },
}));
