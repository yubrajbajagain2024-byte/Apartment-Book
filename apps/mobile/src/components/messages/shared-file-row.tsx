import { Text, View } from "react-native";
import type { MessageAttachment } from "@apartment-book/shared";
import { AttachmentFileRow } from "@/components/messages/attachment-file-row";
import { space } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";

/** One row of a chat's Files tab: the chat's own file row (icon, name, size), with who sent it and when under it. */
export function SharedFileRow({ attachment, url, meta, onPress }: { attachment: MessageAttachment; url: string | undefined; meta: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <AttachmentFileRow attachment={attachment} url={url} onPress={onPress} />
      <Text style={styles.meta} numberOfLines={1}>
        {meta}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { paddingHorizontal: space.lg, paddingVertical: 6, gap: 4 },
  meta: { fontSize: 12, color: colors.faint, paddingHorizontal: 2 },
}));
