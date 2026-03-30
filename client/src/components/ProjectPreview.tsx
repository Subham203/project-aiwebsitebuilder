import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Project } from '../types'
import { iframeScript } from '../assets/assets'
import EditorPanel from './EditorPanel'
import LoaderSteps from './LoaderSteps'

interface ProjectPreviewProps {
  project: Project
  isGenerating: boolean
  device?: 'phone' | 'tablet' | 'desktop'
  showEditorPanel?: boolean
}

export interface ProjectPreviewRef {
  getCode: () => string | undefined
}

const ProjectPreview = forwardRef<ProjectPreviewRef, ProjectPreviewProps>(
  ({ project, isGenerating, device = 'desktop', showEditorPanel = true }, ref) => {
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const [selectedElement, setSelectedElement] = useState<any>(null)

    const resolutions = {
      phone: 'max-w-[412px]',
      tablet: 'max-w-[768px]',
      desktop: 'w-full',
    }

    useImperativeHandle(ref, () => ({
      getCode: () => {
        const doc = iframeRef.current?.contentDocument
        if (!doc) return undefined

        // Cleanup before returning code
        doc.querySelectorAll('.ai-selected-element,[data-ai-selected]').forEach((el) => {
          el.classList.remove('ai-selected-element')
          el.removeAttribute('data-ai-selected')
          ;(el as HTMLElement).style.outline = ''
        })

        doc.getElementById('ai-preview-style')?.remove()
        doc.getElementById('ai-preview-script')?.remove()

        return doc.documentElement.outerHTML
      },
    }))

    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'ELEMENT_SELECTED') {
          setSelectedElement(event.data.payload)
        } else if (event.data.type === 'CLEAR_SELECTION') {
          setSelectedElement(null)
        }
      }

      window.addEventListener('message', handleMessage)
      return () => window.removeEventListener('message', handleMessage)
    }, [])

    const handleUpdate = (updates: any) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: 'UPDATE_ELEMENT', payload: updates },
          '*'
        )
      }
    }

    const injectPreview = (html: string) => {
      if (!html) return ''

      // 1. Force Tailwind CDN into the head if it's missing
      const tailwindScript = '<script src="https://cdn.tailwindcss.com"></script>'
      
      let finalContent = html;

      // 2. Ensure basic HTML structure exists
      if (!html.includes('<html')) {
        finalContent = `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              ${tailwindScript}
            </head>
            <body class="bg-white">
              ${html}
            </body>
          </html>
        `;
      } else if (!html.includes('tailwindcss.com')) {
        // If it's a full doc but missing Tailwind, inject it into the <head>
        finalContent = html.replace('<head>', `<head>${tailwindScript}`);
      }

      // 3. Inject the Editor Interaction Script
      if (showEditorPanel) {
        if (finalContent.includes('</body>')) {
          finalContent = finalContent.replace('</body>', `${iframeScript}</body>`);
        } else {
          finalContent += iframeScript;
        }
      }

      return finalContent;
    }

    return (
      <div className="relative h-full w-full bg-gray-900 flex-1 rounded-xl overflow-hidden flex flex-col">
        {project.current_code ? (
          <div className="flex-1 w-full flex justify-center items-center bg-gray-800/50 p-4">
            <iframe
              key={project.id || 'preview'} 
              ref={iframeRef}
              srcDoc={injectPreview(project.current_code)}
              className={`h-full border-0 ${resolutions[device]} bg-white transition-all duration-300 shadow-2xl rounded-md`}
              title="Project Preview"
            />
            
            {showEditorPanel && selectedElement && (
              <EditorPanel
                selectedElement={selectedElement}
                onUpdate={handleUpdate}
                onClose={() => {
                  setSelectedElement(null)
                  iframeRef.current?.contentWindow?.postMessage({ type: 'CLEAR_SELECTION_REQUEST' }, '*')
                }}
              />
            )}
          </div>
        ) : isGenerating ? (
          <LoaderSteps />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Empty Preview
          </div>
        )}
      </div>
    )
  }
)

export default ProjectPreview