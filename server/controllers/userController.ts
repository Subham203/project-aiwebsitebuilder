import { Request, Response } from "express";
import prisma from "../lib/prisma.js";
import openai from "../configs/openai.js";
import Stripe from 'stripe'
// Get User Credits
export const getUserCredits = async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    res.json({ credits: user?.credits ?? 0 });
  } catch (error: any) {
    console.log(error?.message);
    res.status(500).json({ message: error.message });
  }
};

// Create New Project

export const createUserProject = async (req: Request, res: Response) => {
  const userId = req.userId;

  try {
    // 🔒 Auth check
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { initial_prompt } = req.body;

    // 🧾 Validation
    if (!initial_prompt) {
      return res.status(400).json({ message: "Prompt is required" });
    }

    // 👤 Fetch user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 💳 Credit check
    if (user.credits < 5) {
      return res
        .status(403)
        .json({ message: "Add credits to create more projects" });
    }

    // 🏗️ Create project
    const project = await prisma.websiteProject.create({
      data: {
        name:
          initial_prompt.length > 50
            ? initial_prompt.substring(0, 47) + "..."
            : initial_prompt,
        initial_prompt,
        userId,
      },
    });

    // 📊 Increment creations
    await prisma.user.update({
      where: { id: userId },
      data: {
        totalCreation: { increment: 1 },
      },
    });

    // 💬 Save user message
    await prisma.conversation.create({
      data: {
        role: "user",
        content: initial_prompt,
        projectId: project.id,
      },
    });

    // 💸 Deduct credits
    await prisma.user.update({
      where: { id: userId },
      data: {
        credits: { decrement: 5 },
      },
    });

    // ⚡ Send response early
    res.json({ projectId: project.id });

    // ✨ Enhance prompt
    const promptEnhanceResponse = await openai.chat.completions.create({
      model: "stepfun/step-3.5-flash:free",
      messages: [
        {
          role: "system",
          content: `You are a prompt enhancement specialist. Take the user's website request and expand it into a detailed, comprehensive prompt that will help create the best possible website.

Enhance this prompt by:
1. Adding specific design details (layout, color scheme, typography)
2. Specifying key sections and features
3. Describing the user experience and interactions
4. Including modern web design best practices
5. Mentioning responsive design requirements
6. Adding any missing but important elements

Return ONLY the enhanced prompt, nothing else.
Make it detailed but concise (2-3 paragraphs max).`,
        },
        {
          role: "user",
          content: initial_prompt,
        },
      ],
    });

    const enhancedPrompt =
      promptEnhanceResponse?.choices?.[0]?.message?.content ||
      initial_prompt;

    // 💬 Save enhanced prompt
    await prisma.conversation.create({
      data: {
        role: "assistant",
        content: `Enhanced prompt: "${enhancedPrompt}"`,
        projectId: project.id,
      },
    });

    await prisma.conversation.create({
      data: {
        role: "assistant",
        content: "Generating your website...",
        projectId: project.id,
      },
    });

    // 💻 Generate code
    const codeResponse = await openai.chat.completions.create({
      model: "stepfun/step-3.5-flash:free",
      messages: [
        {
          role: "system",
          content: `You are an expert web developer. Create a complete, production-ready, single-page website based on this request: "${enhancedPrompt}"

CRITICAL REQUIREMENTS:
- You MUST output valid HTML ONLY.
- Use Tailwind CSS for ALL styling
- Include this EXACT script in the <head>:
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
- Use Tailwind utility classes extensively
- Make it fully functional with JavaScript inside <script> before </body>
- Make it responsive using sm:, md:, lg:, xl:
- Use animations (animate-*, transition-*)
- Include all necessary meta tags
- Use Google Fonts if needed
- Use placeholder images from https://placehold.co/600x400
- Use gradients for backgrounds

CRITICAL HARD RULES:
1. Output ONLY in message.content
2. No hidden fields
3. No explanations, comments, markdown, or notes
4. No code fences`,
        },
        {
          role: "user",
          content: enhancedPrompt,
        },
      ],
    });

    let code = codeResponse?.choices?.[0]?.message?.content || "";

    // ❌ Handle failure
    if (!code) {
      await prisma.conversation.create({
        data: {
          role: "assistant",
          content: "Unable to generate the code please try again",
          projectId: project.id,
        },
      });

      await prisma.user.update({
        where: { id: userId },
        data: {
          credits: { increment: 5 },
        },
      });

      return;
    }

    // 🧹 Clean code
    code = code
      .replace(/```[a-z]*\n?/gi, "")
      .replace(/```$/g, "")
      .trim();

    // 📦 Save version
    const version = await prisma.version.create({
      data: {
        code,
        description: "Initial version",
        projectId: project.id,
      },
    });

    // 💬 Final message
    await prisma.conversation.create({
      data: {
        role: "assistant",
        content:
          "I've created your website! You can now preview it and request changes.",
        projectId: project.id,
      },
    });

    // 🔄 Update project
    await prisma.websiteProject.update({
      where: { id: project.id },
      data: {
        current_code: code,
        current_version_index: version.id,
      },
    });
  } catch (error: any) {
    console.log(error);

    // ♻️ Refund credits
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          credits: { increment: 5 },
        },
      });
    }

    // 🚨 Error response
    if (!res.headersSent) {
      res.status(500).json({ message: error.message });
    }
  }
};


// Get Single Project
export const getUserProject = async (
  req: Request<{ projectId: string }>,
  res: Response
) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { projectId } = req.params;

    const project = await prisma.websiteProject.findFirst({
      where: { id: projectId, userId },
      include: {
        conversation: { orderBy: { timestamp: "asc" } },
        versions: { orderBy: { timestamp: "asc" } },
      },
    });

    if (!project)
      return res.status(404).json({ message: "Project not found" });

    res.json({ project });
  } catch (error: any) {
    console.log(error?.message);
    res.status(500).json({ message: error.message });
  }
};

// Get All Projects
export const getUserProjects = async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const projects = await prisma.websiteProject.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    res.json({ projects });
  } catch (error: any) {
    console.log(error?.message);
    res.status(500).json({ message: error.message });
  }
};

// Toggle Publish
export const togglePublish = async (
  req: Request<{ projectId: string }>,
  res: Response
) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { projectId } = req.params;

    const project = await prisma.websiteProject.findFirst({
      where: { id: projectId, userId },
    });

    if (!project)
      return res.status(404).json({ message: "Project not found" });

    const updated = await prisma.websiteProject.update({
      where: { id: projectId },
      data: { isPublished: !project.isPublished },
    });

    res.json({
      message: updated.isPublished
        ? "Project Published Successfully"
        : "Project Unpublished",
    });
  } catch (error: any) {
    console.log(error?.message);
    res.status(500).json({ message: error.message });
  }
};

//Controller Function to purchase Credits

export const purchaseCredits = async (req:Request, res:Response)=>{
    try {
      interface Plan {
        credits: number;
        amount: number;
      }

      const plans= {
        basic: {credits: 100, amount: 5},
        pro: {credits: 400, amount: 19},
        enterprise: {credits: 1000, amount: 49},

      }

      const userId =  req.userId;
      const {planId} =  req.body as {planId: keyof typeof plans}
      const origin =req.headers.origin as string

      const plan: Plan = plans[planId]

      if(!plan){
        return res.status(404).json({message: 'Plan not found'});
      }

      const transaction = await prisma.transaction.create({
        data:{
          userId: userId!,
          planId: req.body.planId,
          amount: plan.amount,
          credits: plan.credits
        }
      })

      const stripe =new Stripe(process.env.STRIPE_SECRET_KEY as string)

      
      const session = await stripe.checkout.sessions.create({
        success_url: `${origin}/loading`,
        cancel_url: `${origin}`,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `AiSiteBuilder - ${plan.credits}`
              },
              unit_amount: Math.floor(transaction.amount) * 100
            },
            quantity:1
          },
        ],
        mode: 'payment',
        metadata: {
          transactionId: transaction.id,
          appId: 'ai-site-builder'
        },
        expires_at: Math.floor(Date.now()/1000)+30*60,
      })
      res.json({payment_link: session.url})
    } catch (error:any) {
      console.log(error.code || error.message);
      res.status(500).json({message: error.message});
    }

}