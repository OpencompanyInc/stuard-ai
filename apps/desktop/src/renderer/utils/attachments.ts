export type {
  ChatAttachment,
  ChatAttachmentKind,
} from '../../../../../shared/chat-ui/attachments';
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
} from '../../../../../shared/chat-ui/attachments';
