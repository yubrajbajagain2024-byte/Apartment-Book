import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { signInSchema } from "@apartment-book/shared";
import { Button, Field, Screen } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

export default function LoginScreen() {
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
    router.dismissTo("/(tabs)");
  }

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ gap: 16, paddingTop: 12 }}>
        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>Welcome back</Text>
        <Text style={{ color: colors.muted }}>Log in with your university email.</Text>
        <Field label="University email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="you@txstate.edu" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" placeholder="••••••••" onSubmitEditing={submit} />
        {error ? <Text style={{ color: colors.red }}>{error}</Text> : null}
        <Button title="Log in" onPress={submit} loading={busy} />
        <Pressable onPress={() => router.replace("/(auth)/signup")}>
          <Text style={{ textAlign: "center", color: colors.brand, fontWeight: "600" }}>New here? Create an account</Text>
        </Pressable>
        <Pressable
          onPress={async () => {
            if (!email) return setError("Enter your email first, then tap this again.");
            const { error: err } = await supabase.auth.resetPasswordForEmail(email);
            setError(err ? err.message : "Check your email for a reset link.");
          }}
        >
          <Text style={{ textAlign: "center", color: colors.muted }}>Forgot password?</Text>
        </Pressable>
        <View style={{ height: 24 }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
