import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Loading } from "@/components/ui";

/**
 * The entry route. AuthGate in _layout.tsx does the real routing; this exists
 * so a cold start on "/" resolves to something rather than rendering nothing
 * while the session loads.
 */
export default function Index() {
  const { session, me, loading } = useAuth();

  if (loading) return <Loading />;
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  if (!me) return <Loading label="Loading your account…" />;
  if (me.profile.status === "suspended") return <Redirect href="/suspended" />;

  return <Redirect href={me.profile.role === "tutor" ? "/(tutor)" : "/(student)"} />;
}
