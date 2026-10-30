// Is a training session on screen right now? (Other UI — e.g. the feedback window — waits for it to end.)
let trainingOpen = false
export function setTrainingOpen(open: boolean) { trainingOpen = open }
export function isTrainingOpen(): boolean { return trainingOpen }
