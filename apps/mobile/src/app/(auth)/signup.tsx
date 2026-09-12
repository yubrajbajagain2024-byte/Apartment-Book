import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { createSignUpSchema, getAllowedEmailDomains } from "@apartment-book/shared";
import { Button, Field, Screen } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { SITE_URL, supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

export default function SignupScreen() {
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
    if (data.session) return router.dismissTo("/(tabs)");
    setDone(true);
  }

  if (done) {
    return (
      <Screen>
        <View style={{ gap: 12, paddingTop: 24 }}>
          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>Check your email</Text>
          <Text style={{ color: colors.muted, fontSize: 16 }}>We sent a confirmation link to {email}. Open it, then come back and log in.</Text>
          <Button title="Go to log in" onPress={() => router.replace("/(auth)/login")} />
        </View>
      </Screen>
    );
  }
  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ gap: 16, paddingTop: 12 }}>
        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>Create your account</Text>
        <Text style={{ color: colors.muted }}>Students only: sign up with your {domains?.length ? domains.map((d) => `@${d}`).join(" or ") : "university"} email.</Text>
        <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" textContentType="name" placeholder="Maya Torres" />
        <Field label="University email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@txstate.edu" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="At least 8 characters" onSubmitEditing={submit} />
        {error ? <Text style={{ color: colors.red }}>{error}</Text> : null}
        <Button title="Create account" onPress={submit} loading={busy} />
        <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>
          By joining you agree to our{" "}
          <Text style={{ color: colors.brand }} onPress={() => void Linking.openURL(`${SITE_URL}/terms`)}>
            Terms
          </Text>{" "}
          and{" "}
          <Text style={{ color: colors.brand }} onPress={() => void Linking.openURL(`${SITE_URL}/privacy`)}>
            Privacy policy
          </Text>
          .
        </Text>
        <Pressable onPress={() => router.replace("/(auth)/login")}>
          <Text style={{ textAlign: "center", color: colors.brand, fontWeight: "600" }}>Already have an account? Log in</Text>
        </Pressable>
        <View style={{ height: 24 }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
