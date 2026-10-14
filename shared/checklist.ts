import type { Video } from './types'

/** Final review checklist: every item must be checked before a full video is approved. */
export const CHECKLIST = [
  { id: 'title', label: 'Título diferente dos últimos 15 do canal' },
  { id: 'hook', label: 'O gancho entrega o que o título promete em até 8 s' },
  { id: 'sources', label: 'Pelo menos 2 fatos com fonte (na descrição)' },
  { id: 'thumb', label: 'Thumbnail legível no tamanho do celular' },
  { id: 'face', label: 'Rosto editado aprovado na checagem de identidade' },
  { id: 'unique', label: '"Isso poderia ter saído de outro canal?" Resposta: não' }
] as const

export type ChecklistId = (typeof CHECKLIST)[number]['id']

/** Items that apply to this video (the face item only when a real face was used). */
export function checklistFor(video: Pick<Video, 'face_check'>): (typeof CHECKLIST)[number][] {
  return CHECKLIST.filter((c) => c.id !== 'face' || !!video.face_check)
}

/** Labels of the items still unchecked; empty when the video can be approved. */
export function checklistMissing(video: Pick<Video, 'face_check' | 'checklist'>): string[] {
  return checklistFor(video)
    .filter((c) => !video.checklist?.[c.id])
    .map((c) => c.label)
}
