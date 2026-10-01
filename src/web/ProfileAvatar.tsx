import { hermesBrandDark, hermesBrandLight } from './hermes-avatar';

/** Images are bounded data URIs supplied by the bridge, never upstream requests. */
export function ProfileAvatar({ avatar, label, size = 16 }: { avatar?: string; label: string; size?: number }) {
  return <span className="profile-avatar" style={{ width: size, height: size }} title={avatar ? `${label} avatar` : 'Hermes brand avatar'}>
    {avatar ? <img src={avatar} alt="" width={size} height={size} /> : <><img className="avatar-light" src={hermesBrandLight} alt="" width={size} height={size} /><img className="avatar-dark" src={hermesBrandDark} alt="" width={size} height={size} /></>}
  </span>;
}
