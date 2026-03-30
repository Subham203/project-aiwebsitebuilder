import {Request,Response} from 'express'
import prisma from '../lib/prisma.js';
import openai from '../configs/openai.js'

//Controller Function to make Revision
export const makeRevision = async (
  req: Request<{ projectId: string }>,
  res: Response
) => {
  const userId = req.userId;

  try {
    const { projectId } = req.params;
    const { message } = req.body;

    // 🔒 Auth + user check
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!userId || !user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 💳 Credit check
    if (user.credits < 2) {
      return res
        .status(403)
        .json({ message: "add more credits to make changes" });
    }

    // 🧾 Validation
    if (!message || message.trim() === "") {
      return res
        .status(400)
        .json({ message: "Please entera valid prompt" });
    }

    // 📦 Fetch project
    const currentProject = await prisma.websiteProject.findFirst({
      where: { id: projectId, userId },
      include: { versions: true },
    });

    if (!currentProject) {
      return res.status(404).json({ message: "Project not found" });
    }

    // 💬 Save user message
    await prisma.conversation.create({
      data: {
        role: "user",
        content: message,
        projectId,
      },
    });

    // 💸 Deduct credits
    await prisma.user.update({
      where: { id: userId },
      data: {
        credits: { decrement: 2 },
      },
    });

    // ✨ Enhance prompt
    const promptEnhanceResponse =
      await openai.chat.completions.create({
        model: "stepfun/step-3.5-flash:free",
        messages: [
          {
            role: "system",
            content: `You are a prompt enhancement specialist. The user wants to make changes to their website. Enhance their request to be more specific and actionable for a web developer.

Enhance this by:
1. Being specific about what elements to change
2. Mentioning design details (colors, spacing, sizes)
3. Clarifying the desired outcome
4. Using clear technical terms

Return ONLY the enhanced request, nothing else. Keep it concise (1-2 sentences).`,
          },
          {
            role: "user",
            content: `User's request: "${message}"`,
          },
        ],
      });

    const enhancedPrompt =
      promptEnhanceResponse.choices[0].message.content;

    // 💬 Save enhanced prompt
    await prisma.conversation.create({
      data: {
        role: "assistant",
        content: `I've enhanced your prompt to: "${enhancedPrompt}"`,
        projectId,
      },
    });

    await prisma.conversation.create({
      data: {
        role: "assistant",
        content: "Now making changes to your website...",
        projectId,
      },
    });

    // 💻 Generate updated code
    const codeGenerationResponse =
      await openai.chat.completions.create({
        model: "stepfun/step-3.5-flash:free",
        messages: [
          {
            role: "system",
            content: `You are an expert web developer.

CRITICAL REQUIREMENTS:
- Return ONLY the complete updated HTML code with the requested changes.
- Use Tailwind CSS for ALL styling (NO custom CSS).
- Use Tailwind utility classes for all styling changes.
- Include all JavaScript in <script> tags before closing </body>
- Make sure it's a complete, standalone HTML document with Tailwind CSS
- Return the HTML Code Only, nothing else

Apply the requested changes while maintaining the Tailwind CSS styling approach.`,
          },
          {
            role: "user",
            content: `Here is the current website code:"${currentProject.current_code}" The user wants this change: "${enhancedPrompt}"`,
          },
        ],
      });

    const code =
      codeGenerationResponse.choices[0].message.content || "";

    // ❌ Handle failure
    if (!code) {
      await prisma.conversation.create({
        data: {
          role: "assistant",
          content: "Unable to generate the code please try again",
          projectId,
        },
      });

      await prisma.user.update({
        where: { id: userId },
        data: {
          credits: { increment: 2 },
        },
      });

      return;
    }

    // 🧹 Clean code
    const cleanedCode = code
      .replace(/```[a-z]*\n?/gi, "")
      .replace(/```$/g, "")
      .trim();

    // 📦 Save version
    const version = await prisma.version.create({
      data: {
        code: cleanedCode,
        description: "changes made",
        projectId,
      },
    });

    // 💬 Final message
    await prisma.conversation.create({
      data: {
        role: "assistant",
        content:
          "I've made some changes to your website! You can now preview it",
        projectId,
      },
    });

    // 🔄 Update project
    await prisma.websiteProject.update({
      where: { id: projectId },
      data: {
        current_code: cleanedCode,
        current_version_index: version.id,
      },
    });

    // ✅ Response
    res.json({ message: "Changes made successfully" });
  } catch (error: any) {
    // ♻️ Refund credits
    await prisma.user.update({
      where: { id: userId },
      data: {
        credits: { increment: 2 },
      },
    });

    console.log(error.code || error.message);

    res.status(500).json({ message: error.message });
  }
};

//Controller Function to Rollback to Previous Version
type Params = {// I had to do this in order to convert it into string|| string[] to string only
  projectId: string;
  versionId: string;
};
export const rollBackToVersion=async (req:Request<Params>, res:Response)=>{
    try {
        const userId = req.userId;
        if(!userId){
            return res.status(401).json({message:'Unauthorized'});
        }
        const {projectId, versionId} = req.params;

        const project = await prisma.websiteProject.findFirst({
            where:{id:projectId,userId},
            include:{ versions:true}
        })

        if(!project){
            return res.status(404).json({message:'Project not found'})
        }

        const version = await prisma.version.findFirst({
            where: { id: versionId, projectId }
        });

        if(!version){
            return res.status(404).json({message: 'Version not found'});
        }

        await prisma.websiteProject.update({
            where:{id:projectId,userId},
            data:{
                current_code:version.code,
                current_version_index: version.id
            }
        })

        await prisma.conversation.create({
            data:{
                role:'assistant',
                content:"I've rolled back your website to selected version.You can now preview it",
                projectId
            }
        })

        res.json({message: 'Version rolled back'});
    } catch (error:any) {
        console.log(error.code || error.message);
        res.status(500).json({message: error.message});
    }
}

//Controller Function to Delete a Project
export const deleteProject=async (req:Request<{projectId:string}>, res:Response)=>{
    try {
        const userId = req.userId;
        const {projectId} = req.params;

        await prisma.websiteProject.deleteMany({
            where:{id:projectId,userId},
        })

        res.json({message: 'Project deleted successfully'});
    } catch (error:any) {
        console.log(error.code || error.message);
        res.status(500).json({message: error.message});
    }
}

//Controller for getting project code for preview
export const getProjectPreview= async (req:Request<{projectId:string}>, res:Response)=>{
    try {
        const userId = req.userId;
        const {projectId} = req.params;

        if(!userId){
            return res.status(401).json({message: 'Unauthorized'});
        }

        const project = await prisma.websiteProject.findFirst({
            where:{id:projectId,userId},
            include: {versions: true}
        })

        if(!project){
            return res.status(404).json({message: 'Project not found'});
        }
        res.json({code: project.current_code,versions: project.versions});
    } catch (error:any) {
        console.log(error.code || error.message);
        res.status(500).json({message: error.message});
    }
}

//Get published projects
export const getPublishedProjects= async (req:Request<{projectId:string}>, res:Response)=>{
    try {

        const projects = await prisma.websiteProject.findMany({
            where:{isPublished: true},
            include: {user:true}
        })

        res.json({projects});
    } catch (error:any) {
        console.log(error.code || error.message);
        res.status(500).json({message: error.message});
    }
}

//get single project by id

export const getProjectById= async (req:Request<{projectId:string}>, res:Response)=>{
    try {
        const { projectId }= req.params;
        const project = await prisma.websiteProject.findFirst({
            where:{id: projectId},
            
        })

        if(!project || project.isPublished === false || !project?.current_code){
            return res.status(404).json({message:'Project not found'});  
        }

        res.json({code:project.current_code});
    } catch (error:any) {
        console.log(error.code || error.message);
        res.status(500).json({message: error.message});
    }
}

//Controller to save project code

export const saveProjectCode= async (req:Request<{projectId:string}>, res:Response)=>{
    try {
        const userId=req.userId; 
        const { projectId }= req.params;
        const {code}=req.body;
        if(!userId){
            return res.status(401).json({message: 'Unauthorized'});
        }
        if(!code){
            return res.status(400).json({message: 'Code is required'});
        }

        const project= await prisma.websiteProject.findFirst({
            where: {id:projectId, userId}
        })
        if(!project){
            return res.status(404).json({message: 'Project not found'});
        }
        await prisma.websiteProject.update({
            where:{id:projectId},
            data:{current_code: code, current_version_index:''}
        })

        res.json({message:'Project saved successfully'});
    } catch (error:any) {
        console.log(error.code || error.message);
        res.status(500).json({message: error.message});
    }
}