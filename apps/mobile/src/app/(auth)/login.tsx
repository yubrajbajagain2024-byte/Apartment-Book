import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { signInSchema } from "@apartment-book/shared";
import { Button, Field, Screen } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { space, type } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";

/** The welcome back: a serif headline, an italic line under it, eyebrow-labelled fields, the ink button and two quiet links. */
export default function LoginScreen() {
  const styles = useStyles();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check your details");
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword(parsed.data);
    setBusy(false);
    if (err) return setError(err.message);
    // Close only this modal: the screen underneath (a tab, the inbox, a search) re-renders signed in.
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.form}>
        <View style={styles.welcome}>
          <Text style={styles.headline} accessibilityRole="header">
            Welcome back
          </Text>
          <Text style={styles.tagline}>Log in with your university email.</Text>
        </View>
        <Field label="University email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="you@txstate.edu" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" placeholder="••••••••" onSubmitEditing={submit} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Log in" onPress={submit} loading={busy} style={styles.submit} />
        <Pressable onPress={() => router.replace("/(auth)/signup")} hitSlop={8} accessibilityRole="button" style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
          <Text style={styles.linkText}>New here? Create an account</Text>
        </Pressable>
        <Pressable
          onPress={async () => {
            if (!email) return setError("Enter your email first, then tap this again.");
            const { error: err } = await supabase.auth.resetPasswordForEmail(email);
            setError(err ? err.message : "Check your email for a reset link.");
          }}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Text style={styles.quiet}>Forgot password?</Text>
        </Pressable>
        <View style={{ height: space.xl }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  form: { gap: space.lg, paddingTop: space.md },
  // The headline and its italic line sit a little apart from the fields, like a brand's welcome.
  welcome: { gap: space.sm, paddingTop: space.lg, paddingBottom: space.sm },
  headline: { ...type.display, color: colors.text },
  tagline: { ...type.aside, color: colors.muted },
  error: { ...type.caption, fontSize: 14, color: colors.red, marginLeft: 2 },
  submit: { marginTop: space.xs },
  link: { alignSelf: "center", paddingVertical: space.xs, paddingHorizontal: space.sm },
  pressed: { opacity: 0.7 },
  linkText: { ...type.label, fontSize: 15, color: colors.brand, textAlign: "center" },
  quiet: { ...type.caption, color: colors.muted, textAlign: "center" },
}));
