import { Tabs } from "expo-router/tabs";
import { useAuth } from "@/lib/auth";
import { usePalette } from "@/components/ui";
import { TabIcon } from "@/components/TabIcon";

/**
 * `expo-router/tabs`, not `expo-router`.
 *
 * In expo-router 57 the Tabs layout moved to its own subpath — importing it
 * from the package root (which worked in earlier versions) resolves to
 * undefined and fails at render with a message that points nowhere near the
 * cause. Verified against the installed package's own type definitions.
 */
export default function StudentTabsLayout() {
  const palette = usePalette();
  const { me } = useAuth();
  const unread = me?.badges.unreadMessages ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.royal,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.hairline },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarIcon: ({ color }) => <TabIcon name="home" color={color} /> }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Find",
          tabBarIcon: ({ color }) => <TabIcon name="search" color={color} />,
        }}
      />
      <Tabs.Screen
        name="lessons"
        options={{
          title: "Lessons",
          tabBarIcon: ({ color }) => <TabIcon name="lessons" color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          // Undefined rather than 0: a badge showing "0" is worse than none.
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarIcon: ({ color }) => <TabIcon name="messages" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <TabIcon name="profile" color={color} />,
        }}
      />
    </Tabs>
  );
}
