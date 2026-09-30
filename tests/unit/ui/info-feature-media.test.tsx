import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InfoFeatureMedia } from '@/ui/layers/InfoFeatureMedia';
const hls = vi.hoisted(()=>({supported:true,load:vi.fn(),attach:vi.fn(),destroy:vi.fn(),on:vi.fn()}));
vi.mock('hls.js',()=>({default:class {
 static isSupported(){return hls.supported;} static Events={ERROR:'error',MANIFEST_PARSED:'parsed'};
 loadSource=hls.load;attachMedia=hls.attach;destroy=hls.destroy;on=hls.on;
}}));
const media={previewUrl:null,playbackUrl:'/api/traffic-cameras/direct/NJ/123/hls',sourceHref:'https://511nj.org/camera',refreshSeconds:null,videoAvailable:true};
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();hls.supported=true;});
it('does not load live video until explicitly requested',()=>{
 const {container}=render(<InfoFeatureMedia media={media} name="River road"/>);
 expect(screen.getByRole('button',{name:'Play live camera'})).toBeInTheDocument();
 expect(container.querySelector('video')?.getAttribute('src')).toBeNull();
 expect(container.querySelector('source')).toBeNull();
 expect(hls.load).not.toHaveBeenCalled();
});
it('uses native HLS after a user request and releases its source on unmount',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('probably');
 vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 const {container,unmount}=render(<InfoFeatureMedia media={media} name="River road"/>);
 const video=container.querySelector('video')!;
 fireEvent.click(screen.getByRole('button',{name:'Play live camera'}));
 await waitFor(()=>expect(video.getAttribute('src')).toBe(media.playbackUrl));
 expect(hls.load).not.toHaveBeenCalled();unmount();
 expect(video.getAttribute('src')).toBeNull();
});
it('loads an MSE player on demand and destroys it when the card closes',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('');
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 const {unmount}=render(<InfoFeatureMedia media={media} name="River road"/>);
 fireEvent.click(screen.getByRole('button',{name:'Play live camera'}));
 await waitFor(()=>expect(hls.load).toHaveBeenCalledWith(media.playbackUrl));
 expect(hls.attach).toHaveBeenCalled();unmount();expect(hls.destroy).toHaveBeenCalled();
});
it('explains unsupported video without claiming playback works',async()=>{
 hls.supported=false;
 vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('');
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 render(<InfoFeatureMedia media={media} name="River road"/>);
 fireEvent.click(screen.getByRole('button',{name:'Play live camera'}));
 expect(await screen.findByRole('status')).toHaveTextContent('Live video is unavailable in this browser.');
 expect(screen.getByRole('link',{name:'Open provider camera'})).toHaveAttribute('href',media.sourceHref);
});
it('shows a playback error and stops the failed stream',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('');
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 render(<InfoFeatureMedia media={media} name="River road"/>);
 fireEvent.click(screen.getByRole('button',{name:'Play live camera'}));
 await waitFor(()=>expect(hls.on).toHaveBeenCalled());
 const failure=hls.on.mock.calls.find(call=>call[0]==='error')![1];
 const {act}=await import('@testing-library/react');
 act(()=>failure('error',{fatal:true}));
 expect(screen.getByRole('status')).toHaveTextContent('Live camera is unavailable.');
 expect(hls.destroy).toHaveBeenCalledTimes(1);
});
it('switching cameras destroys playback and requires another explicit request',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('');
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 const {rerender}=render(<InfoFeatureMedia media={media} name="River road"/>);
 fireEvent.click(screen.getByRole('button',{name:'Play live camera'}));
 await waitFor(()=>expect(hls.load).toHaveBeenCalledTimes(1));
 rerender(<InfoFeatureMedia media={{...media,playbackUrl:'/api/traffic-cameras/direct/MD/456/hls'}} name="Hill road"/>);
 expect(hls.destroy).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:'Play live camera'})).toBeInTheDocument();
 expect(hls.load).toHaveBeenCalledTimes(1);
});
