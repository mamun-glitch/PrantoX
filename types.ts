
export interface Message {
  role: 'user' | 'model';
  text: string;
  image?: string; // Base64 string for display
  timestamp: number;
}
