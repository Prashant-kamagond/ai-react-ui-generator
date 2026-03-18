import type { FileNode } from "@/lib/file-system";
import { VirtualFileSystem } from "@/lib/file-system";
import { streamText, appendResponseMessages } from "ai";
import { buildStrReplaceTool } from "@/lib/tools/str-replace";
import { buildFileManagerTool } from "@/lib/tools/file-manager";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getLanguageModel } from "@/lib/provider";
import { generationPrompt } from "@/lib/prompts/generation";

export async function POST(req: Request) {

  const {
    messages,
    files,
    projectId,
  }: { messages: any[]; files: Record<string, FileNode>; projectId?: string } =
    await req.json();

  const userPrompt = messages[messages.length - 1]?.content?.toLowerCase() || "";

  // CUSTOM GENERATOR WHEN NO API KEY
  if (!process.env.ANTHROPIC_API_KEY) {

    let componentCode = "";

    if (userPrompt.includes("dashboard")) {
      componentCode = `
export default function App() {
  return (
    <div style={{padding:"30px",fontFamily:"sans-serif"}}>
      <h1>AI Analytics Dashboard</h1>
      <div style={{display:"flex",gap:"20px"}}>
        <div style={{background:"#f1f1f1",padding:"20px"}}>Users: 1200</div>
        <div style={{background:"#f1f1f1",padding:"20px"}}>Revenue: $12K</div>
        <div style={{background:"#f1f1f1",padding:"20px"}}>Growth: 24%</div>
      </div>
    </div>
  );
}
`;
    }

    else if (userPrompt.includes("navbar")) {
      componentCode = `
export default function App(){
  return (
    <nav style={{display:"flex",gap:"20px",padding:"20px",background:"#333",color:"#fff"}}>
      <h3>MyApp</h3>
      <a>Home</a>
      <a>Features</a>
      <a>Pricing</a>
      <a>Contact</a>
    </nav>
  );
}
`;
    }

    else if (userPrompt.includes("pricing")) {
      componentCode = `
export default function App(){
  return (
    <div style={{display:"flex",gap:"20px",padding:"40px"}}>
      <div style={{border:"1px solid #ccc",padding:"20px"}}>
        <h2>Basic</h2>
        <p>$9/month</p>
      </div>
      <div style={{border:"1px solid #ccc",padding:"20px"}}>
        <h2>Pro</h2>
        <p>$29/month</p>
      </div>
      <div style={{border:"1px solid #ccc",padding:"20px"}}>
        <h2>Enterprise</h2>
        <p>$99/month</p>
      </div>
    </div>
  );
}
`;
    }

    else {
      componentCode = `
export default function App(){
  return (
    <div style={{padding:"30px"}}>
      <h2>Amazing Product</h2>
      <p>This product will change your life.</p>
      <button>Learn More</button>
    </div>
  );
}
`;
    }

    return new Response(JSON.stringify({
      files: {
        "/src/App.jsx": componentCode
      }
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // ORIGINAL AI SYSTEM BELOW

  messages.unshift({
    role: "system",
    content: generationPrompt,
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  });

  const fileSystem = new VirtualFileSystem();
  fileSystem.deserializeFromNodes(files);

  const model = getLanguageModel();

  const result = streamText({
    model,
    messages,
    maxTokens: 10_000,
    maxSteps: 40,
    tools: {
      str_replace_editor: buildStrReplaceTool(fileSystem),
      file_manager: buildFileManagerTool(fileSystem),
    },
    onFinish: async ({ response }) => {

      if (projectId) {
        try {

          const session = await getSession();
          if (!session) return;

          const responseMessages = response.messages || [];

          const allMessages = appendResponseMessages({
            messages: [...messages.filter((m) => m.role !== "system")],
            responseMessages,
          });

          await prisma.project.update({
            where: {
              id: projectId,
              userId: session.userId,
            },
            data: {
              messages: JSON.stringify(allMessages),
              data: JSON.stringify(fileSystem.serialize()),
            },
          });

        } catch (error) {
          console.error("Failed to save project data:", error);
        }
      }

    },
  });

  return result.toDataStreamResponse();
}

export const maxDuration = 120;