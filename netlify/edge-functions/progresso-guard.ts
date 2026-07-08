export default async function (_req: Request, context: any) {
  if (context.deploy.context === "production") {
    return new Response("Not Found", { status: 404 });
  }
}

export const config = { path: "/progresso*" };
