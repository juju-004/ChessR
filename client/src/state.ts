export interface CurrentUser {
  id: string;
  username: string;
  rating: number;
}

type Listener = () => void;

class AuthState {
  accessToken: string | null = null;
  user: CurrentUser | null = null;
  private listeners = new Set<Listener>();

  set(accessToken: string, user: CurrentUser) {
    this.accessToken = accessToken;
    this.user = user;
    this.emit();
  }

  clear() {
    this.accessToken = null;
    this.user = null;
    this.emit();
  }

  get isAuthed() {
    return !!this.accessToken && !!this.user;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}

export const authState = new AuthState();
