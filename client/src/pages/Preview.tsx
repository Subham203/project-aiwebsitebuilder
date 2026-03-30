import { useEffect, useState, useRef } from "react"
import { useParams } from "react-router-dom"
import { Loader2Icon } from "lucide-react"
import ProjectPreview from "../components/ProjectPreview"
import type { Project } from "../types"
import api from "@/configs/axios"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"

const Preview = () => {
  const { data: session, isPending } = authClient.useSession()
  const { projectId } = useParams()

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const hasFetched = useRef(false)

  const fetchCode = async () => {
    try {
      setLoading(true)
      const { data } = await api.get(`/api/project/preview/${projectId}`)

      // Mapping the API response to the expected Project shape
      if (data && data.code) {
        setProject({
          id: projectId || 'temp-id',
          current_code: data.code,
          name: "Project Preview",
          // Add other defaults if your Project type requires them
        } as Project)
      } else {
        toast.error("No code found in this project.")
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to load preview")
      console.error("Fetch Error:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Session load hone ka wait karein aur check karein ki fetch pehle toh nahi hua
    if (!isPending && session?.user && !hasFetched.current) {
      hasFetched.current = true
      fetchCode()
    }
  }, [session?.user?.id, projectId, isPending])

  if (loading || isPending) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-950">
        <Loader2Icon className="size-10 animate-spin text-indigo-500 mb-4" />
        <p className="text-indigo-200">Generating Preview...</p>
      </div>
    )
  }

  return (
    <div className="h-screen w-full bg-gray-950">
      {project ? (
        <ProjectPreview
          project={project}
          isGenerating={false}
          showEditorPanel={false} // Preview mode mein editor hide rakhte hain
        />
      ) : (
        <div className="flex items-center justify-center h-full text-gray-500">
          Project not found or connection refused.
        </div>
      )}
    </div>
  )
}

export default Preview