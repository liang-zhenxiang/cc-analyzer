export const clipboard = {
  writeText(text: string): Promise<void> {
    return navigator.clipboard.writeText(text);
  }
};
