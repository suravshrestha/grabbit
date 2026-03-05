declare module '#imports' {
  export function defineBackground(setup: () => void | Promise<void>): () => void | Promise<void>

  export function defineContentScript(config: {
    matches: string[]
    main: () => void | Promise<void>
  }): {
    matches: string[]
    main: () => void | Promise<void>
  }
}
