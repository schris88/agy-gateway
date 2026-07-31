/**
 * Converts standard Markdown to WhatsApp formatting tags.
 * WhatsApp syntax:
 * *bold*
 * _italic_
 * ~strikethrough~
 * ```monospaced block```
 */
function markdownToWhatsApp(text) {
  if (!text) return '';

  let formatted = text;

  // Preserve multi-line code blocks
  const codeBlocks = [];
  formatted = formatted.replace(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (match, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`\`\`\`\n${code.trim()}\n\`\`\``);
    return placeholder;
  });

  // Preserve inline code
  const inlineCodes = [];
  formatted = formatted.replace(/`([^`]+)`/g, (match, code) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(`\`${code}\``);
    return placeholder;
  });

  // Convert headers (# Title, ## Subtitle) to bold *Title*
  formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Convert bold **text** or __text__ to *text*
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');
  formatted = formatted.replace(/__(.*?)__/g, '*$1*');

  // Convert italic *text* (that wasn't converted from bold) to _text_ if wrapped with single asterisk not adjacent to alphanumeric
  // But standard markdown single asterisk or underscore for italic:
  // Convert _italic_ or *italic*
  formatted = formatted.replace(/(?<![*_])_([^_]+)_(?![*_])/g, '_$1_');

  // Convert strikethrough ~~text~~ to ~text~
  formatted = formatted.replace(/~~(.*?)~~/g, '~$1~');

  // Convert unordered lists (- item or * item) to bullet points • item
  formatted = formatted.replace(/^[\s]*[-*]\s+/gm, '• ');

  // Restore inline codes
  inlineCodes.forEach((code, index) => {
    formatted = formatted.replace(`__INLINE_CODE_${index}__`, code);
  });

  // Restore code blocks
  codeBlocks.forEach((code, index) => {
    formatted = formatted.replace(`__CODE_BLOCK_${index}__`, code);
  });

  return formatted.trim();
}

/**
 * Splits text into chunks of maximum size (default 4000) preserving line breaks.
 */
function splitMessage(text, maxLength = 3800) {
  if (!text || text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  const lines = text.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    if ((currentChunk + '\n' + line).length > maxLength) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = line;
      // If a single line exceeds maxLength, hard cut it
      while (currentChunk.length > maxLength) {
        chunks.push(currentChunk.slice(0, maxLength));
        currentChunk = currentChunk.slice(maxLength);
      }
    } else {
      currentChunk = currentChunk ? currentChunk + '\n' + line : line;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

module.exports = {
  markdownToWhatsApp,
  splitMessage,
};
