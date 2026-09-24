import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useNavigation } from "expo-router";

/**
 * Stops a back gesture or the header back button from throwing away edits.
 * Call the returned function immediately before a navigation that should
 * be allowed (a successful save). The ref is what the listener reads, so
 * clearing React state in the same tick is not enough on its own.
 */
export function useDiscardGuard(dirty: boolean) {
  const navigation = useNavigation();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    return navigation.addListener("beforeRemove", (event) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      Alert.alert("Discard changes?", "You have unsaved changes on this screen.", [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            dirtyRef.current = false;
            navigation.dispatch(event.data.action);
          },
        },
      ]);
    });
  }, [navigation]);

  return () => {
    dirtyRef.current = false;
  };
}
