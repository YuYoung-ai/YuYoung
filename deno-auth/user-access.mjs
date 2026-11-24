// The marker outlives the allowlist entry so a re-added account gets fresh sessions.
export const accountVersionKey = uid => ['user_access_version', uid];

export async function removeAuthorizedUser(kv, actor, email, uid, uidForEmail, notificationKey) {
  if (uid === actor.uid) return {error:'self_delete', status:409};
  let admin;
  for await (const entry of kv.list({prefix:['user_email']})) {
    const user = entry.value;
    if (user.status === 'active' && Number(user.level) === 3 && (user.accessVersion || '') === actor.accessVersion
      && await uidForEmail(user.email) === actor.uid) {
      admin = entry;
      break;
    }
  }
  if (!admin) return {error:'forbidden', status:403};
  const account = await kv.get(['user_email',email]);
  const version = await kv.get(accountVersionKey(uid));
  if (!account.value) return version.value ? {ok:true, removed:false} : {error:'user_not_found', status:404};

  const revision = await kv.get(notificationKey('deviceRevision',uid));
  const tx = kv.atomic().check(admin,account,version,revision)
    .delete(account.key)
    .set(version.key,crypto.randomUUID())
    .set(revision.key,Number(revision.value || 0) + 1);
  if (account.value.sub) {
    const identity = await kv.get(['user_sub',account.value.sub]);
    if (identity.value?.email === email) tx.check(identity).delete(identity.key);
  }
  for await (const device of kv.list({prefix:notificationKey('device',uid)})) {
    const subscription = await kv.get(notificationKey('subscription',device.key.at(-1)));
    tx.check(device).delete(device.key);
    if (subscription.value?.uid === uid) tx.check(subscription).delete(subscription.key);
  }
  return (await tx.commit()).ok ? {ok:true, removed:true} : {error:'user_changed', status:409};
}
