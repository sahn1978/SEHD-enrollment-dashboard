import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// When deploying to GitHub Pages under https://USER.github.io/REPO/
// set the base to '/REPO/'. The deploy workflow injects this via env var.
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  plugins: [react()],
  base,
})
