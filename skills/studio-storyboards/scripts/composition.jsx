import React from 'react';
import {AbsoluteFill,Composition,Img,Sequence,interpolate,registerRoot,useCurrentFrame} from 'remotion';
function Shot({shot,frames}){
  const t=interpolate(useCurrentFrame(),[0,Math.max(1,frames-1)],[0,1],{extrapolateRight:'clamp'});
  const motion={push:'scale('+(1+.08*t)+')',pull:'scale('+(1.08-.08*t)+')',left:'scale(1.09) translateX('+((.5-t)*5)+'%)',right:'scale(1.09) translateX('+((t-.5)*5)+'%)',still:'none'};
  return <AbsoluteFill style={{overflow:'hidden',background:'#141412'}}><Img src={shot.src} style={{width:'100%',height:'100%',objectFit:'contain',transform:motion[shot.motion]}}/></AbsoluteFill>;
}
function Film({shots}){
  let start=0;
  return <AbsoluteFill>{shots.map((shot,i)=>{const frames=Math.round(shot.seconds*24),from=start;start+=frames;return <Sequence key={i} from={from} durationInFrames={frames}><Shot shot={shot} frames={frames}/></Sequence>;})}</AbsoluteFill>;
}
const Root=()=> <Composition id="StudioAnimatic" component={Film} durationInFrames={24} fps={24} width={1280} height={720} defaultProps={{shots:[]}} calculateMetadata={({props})=>({durationInFrames:Math.max(1,props.shots.reduce((n,s)=>n+Math.round(s.seconds*24),0))})}/>;
registerRoot(Root);
