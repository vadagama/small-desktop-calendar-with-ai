export const attachmentPath = "/gate/team/api/attachments";
export const maxAttachmentBytes = 10 * 1024 * 1024;
export function isAttachmentUpload(path: string, body: unknown) {
  if (path !== attachmentPath || !(body instanceof FormData)) return false;
  const file = body.get("file");
  return (
    [...body.keys()].length === 2 &&
    body.get("is_public") === "true" &&
    file instanceof Blob &&
    file.size > 0 &&
    file.size <= maxAttachmentBytes
  );
}
