import { ConversationsList } from "@/components/ConversationsList";

export default function TutorMessagesScreen() {
  return (
    <ConversationsList emptyMessage="When a student books a lesson with you, your conversation with them appears here." />
  );
}
