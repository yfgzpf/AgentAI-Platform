/**
 * Profile utility stub — getLocalProfile reads from localStorage
 */
export function getLocalProfile(): { name: string; industry: string } | null {
  try {
    const raw = localStorage.getItem('agentai.profile');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
