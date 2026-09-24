import { Tabs } from "expo-router/tabs";
import { useAuth } from "@/lib/auth";
import { TabIcon } from "@/components/TabIcon";
import { useAdaptiveTabScreenOptions } from "@/lib/adaptive-tabs";

export default function TutorTabsLayout() {
  const { me } = useAuth();
  const unread = me?.badges.unreadMessages ?? 0;
  const screenOptions = useAdaptiveTabScreenOptions();

  return (
    <Tabs
      screenOptions={{
        ...screenOptions,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color }) => <TabIcon name="calendar" color={color} />,
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
