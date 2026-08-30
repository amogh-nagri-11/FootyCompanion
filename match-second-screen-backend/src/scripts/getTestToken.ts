import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from '../config.js';

const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  realtime: { transport: ws as any },
});

const email = 'amoghbhatnagri+test@gmail.com';
const password = 'testpassword123';

async function main() {
  const signInResult = await supabase.auth.signInWithPassword({ email, password });
  let session = signInResult.data.session;

  if (signInResult.error) {
    console.log('Sign in failed, trying sign up...');
    const signUpResult = await supabase.auth.signUp({ email, password });
    if (signUpResult.error) throw signUpResult.error;
    session = signUpResult.data.session;
  }

  console.log('\nAccess token:\n');
  console.log(session?.access_token);
}

main().catch(console.error);