export function chatRequestService(path: string) {
  return /^\/meetings(?:\/|$)/.test(path) || /^\/conversations\/[^/]+\/meetings$/.test(path) ? 'Meeting' : 'Chat';
}

export function chatConnectionError(path: string, timedOut = false) {
  if (chatRequestService(path) === 'Meeting') {
    return timedOut
      ? 'The meeting service took too long to respond. Check your connection and the call status before rejoining.'
      : 'Meeting connection lost. Check your connection and the call status before rejoining.';
  }
  return timedOut ? 'The chat service took too long to respond. Try again when connected.' : 'Chat service unavailable. Try again when connected.';
}
