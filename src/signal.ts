/** A WebRTC signalling message, which must be conveyed out-of-band. */
export type Signal = ICE | SDP;

/** ICE gathering progress */
export interface ICE {
  type: "ice";
  /** New ICE {@link Candidate candidates} for this peer. */
  candidates: Candidate[];
  /** If `true`, the peer has completed ICE gathering. */
  done: boolean;
}

/** An ICE candidate. */
export type Candidate = [attrs: string, media: CandidateMedia | null];

export type CandidateMedia = [id: string | null, index: number | null];

/** An SDP exchange. */
export interface SDP {
  type: "sdp";
  description: SDPDescription;
}

export interface SDPDescription {
  type: SDPDescriptionType;
  contents: string;
}

export type SDPDescriptionType = "offer" | "answer" | "pranswer" | "rollback";
