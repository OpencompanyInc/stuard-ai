export type {
  ChatAttachment,
  ChatAttachmentKind,
} from '@stuardai/chat-ui/attachments';
export {
  isDocumentAttachment,
  getChatAttachmentKind,
  getChatAttachmentDataUrl,
  normalizeChatAttachment,
  normalizeChatAttachments,
  serializeChatAttachment,
  buildAttachmentMessageText,
  shouldConvertPasteToDocumentAttachment,
  createClipboardDocumentAttachment,
} from '@stuardai/chat-ui/attachments';
