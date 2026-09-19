import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { router, Stack } from "expo-router";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import {
  Screen,
  Heading,
  Body,
  Card,
  Button,
  Loading,
  ErrorState,
  usePalette,
} from "@/components/ui";
import { Chooser, type Choice } from "@/components/Chooser";
import { spacing, MIN_TOUCH_TARGET } from "@/lib/theme";

type AvailabilityResponse = {
  timezone: string;
  rules: { day_of_week: number; start_time: string; end_time: string }[];
  exceptions: {
    date: string;
    start_time: string | null;
    end_time: string | null;
    is_available: boolean;
  }[];
};

type Row = { id: string; dayOfWeek: number; startTime: string; endTime: string };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Postgres hands back `09:00:00`; the schema wants `09:00`. */
const hhmm = (value: string) => value.slice(0, 5);

/** Quarter-hour options, rather than a text field.
 *
 * A typed time is a validation failure waiting to happen — "9am", "9:0",
 * "21.00" — and the server rejects all three with a regex message nobody can
 * act on. A list cannot produce an invalid value. */
const TIME_CHOICES: Choice[] = Array.from({ length: 24 * 4 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { value, label: value };
});

let nextId = 0;
const rowId = () => `row-${nextId++}`;

export default function EditAvailabilityScreen() {
  const palette = usePalette();
  const state = useApi<AvailabilityResponse>("/api/v1/availability");
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

  const loaded = state.data;
  useEffect(() => {
    if (!loaded) return;
    setRows(
      loaded.rules.map((rule) => ({
        id: rowId(),
        dayOfWeek: rule.day_of_week,
        startTime: hhmm(rule.start_time),
        endTime: hhmm(rule.end_time),
      })),
    );
    setDirty(false);
  }, [loaded]);

  const save = useMutation(async (payload: Row[]) =>
    api.put<{ ok: boolean; message: string | null }>("/api/v1/availability", {
      rules: payload.map((row) => ({
        dayOfWeek: row.dayOfWeek,
        startTime: row.startTime,
        endTime: row.endTime,
      })),
    }),
  );

  // Caught here as well as on the server so the person is told which row is
  // wrong while they are looking at it, instead of after a round trip that
  // only names the first failure.
  const problem = useMemo(() => {
    const bad = rows.findIndex((row) => row.endTime <= row.startTime);
    if (bad >= 0) return `${DAYS[rows[bad].dayOfWeek]} ends before it starts.`;
    return null;
  }, [rows]);

  if (state.loading) return <Loading />;
  if (state.error || !state.data) {
    return (
      <Screen>
        <ErrorState
          message={state.error ?? "We couldn't load your availability."}
          onRetry={state.reload}
        />
      </Screen>
    );
  }

  const update = (id: string, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setDirty(true);
  };

  const byDay = DAYS.map((_, day) => rows.filter((row) => row.dayOfWeek === day));

  return (
    <Screen>
      <Stack.Screen options={{ title: "Availability" }} />
      <Heading>Weekly availability</Heading>
      <Body muted>
        These are the hours students can book. Times are in {state.data.timezone}, the time zone on
        your profile — students see them converted to their own.
      </Body>

      {DAYS.map((label, day) => (
        <Card key={label}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ fontWeight: "600", color: palette.foreground }}>{label}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add hours on ${label}`}
              onPress={() => {
                setRows((current) => [
                  ...current,
                  { id: rowId(), dayOfWeek: day, startTime: "09:00", endTime: "17:00" },
                ]);
                setDirty(true);
              }}
              hitSlop={8}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                justifyContent: "center",
                paddingHorizontal: spacing.sm,
              }}
            >
              <Text style={{ color: palette.royal, fontWeight: "600" }}>Add hours</Text>
            </Pressable>
          </View>

          {byDay[day].length === 0 ? (
            <Body muted size={14}>
              Not available.
            </Body>
          ) : (
            byDay[day].map((row) => (
              <View key={row.id} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Chooser
                      label="From"
                      choices={TIME_CHOICES}
                      selected={[row.startTime]}
                      onChange={(next) => update(row.id, { startTime: next[0] ?? row.startTime })}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Chooser
                      label="To"
                      choices={TIME_CHOICES}
                      selected={[row.endTime]}
                      onChange={(next) => update(row.id, { endTime: next[0] ?? row.endTime })}
                    />
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${row.startTime} to ${row.endTime} on ${label}`}
                  onPress={() => {
                    setRows((current) => current.filter((item) => item.id !== row.id));
                    setDirty(true);
                  }}
                  style={{
                    minHeight: MIN_TOUCH_TARGET,
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: palette.danger }}>Remove</Text>
                </Pressable>
              </View>
            ))
          )}
        </Card>
      ))}

      {state.data.exceptions.length > 0 ? (
        <Card>
          <Text style={{ fontWeight: "600" }}>Upcoming date exceptions</Text>
          <Body muted size={14}>
            One-off changes to specific dates. Add or remove them on the web for now — this screen
            edits the weekly pattern only, and saving here leaves them untouched.
          </Body>
          {state.data.exceptions.slice(0, 10).map((exception) => (
            <Text
              key={`${exception.date}-${exception.start_time ?? "all"}`}
              style={{ color: palette.muted }}
            >
              {exception.date} ·{" "}
              {exception.is_available
                ? `available ${hhmm(exception.start_time ?? "")}–${hhmm(exception.end_time ?? "")}`
                : "unavailable"}
            </Text>
          ))}
        </Card>
      ) : null}

      {problem ? (
        <Text accessibilityRole="alert" style={{ color: palette.danger }}>
          {problem}
        </Text>
      ) : null}
      {save.error ? (
        <Text accessibilityRole="alert" style={{ color: palette.danger }}>
          {save.error}
        </Text>
      ) : null}

      <Button
        onPress={async () => {
          const result = await save.run(rows);
          if (result) router.back();
        }}
        busy={save.busy}
        disabled={problem !== null || !dirty}
      >
        {save.busy ? "Saving…" : "Save availability"}
      </Button>
      <Button variant="secondary" onPress={() => router.back()}>
        Cancel
      </Button>
    </Screen>
  );
}
