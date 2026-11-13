import { greeting } from "@/lib/greeting";

export default function Home() {
  return (
    <main>
      <h1>{greeting("{{title}}")}</h1>
      <p>
        Edit <code>src/app/page.tsx</code> to get started.
      </p>
    </main>
  );
}
