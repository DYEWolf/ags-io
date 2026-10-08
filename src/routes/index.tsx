import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-2 px-4">
      <h1 className="text-2xl font-semibold">ags-io</h1>
      <p className="text-neutral-600">SEO, GEO y AEO para negocios locales.</p>
    </main>
  )
}
