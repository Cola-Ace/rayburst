/** @fileoverview Clipboard helper shared by app copy actions. */
export async function writeAppClipboardText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}
