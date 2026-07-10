const port = Number(Bun.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(null, { status: 204 });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`HTTP server listening on ${server.url}`);
