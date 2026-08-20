declare module 'bcryptjs' {
  export function hash(value: string, rounds: number): Promise<string>
  export function compare(value: string, hashed: string): Promise<boolean>
}
