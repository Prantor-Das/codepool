"use client"
import { signOut } from '@/lib/auth-client'
import { useRouter } from 'next/navigation'
import React from 'react'

const Logout = ({
    children,
    classname
}:{
    children: React.ReactNode,
    classname?: string 
}) => {

    const router = useRouter();

  return (
    <span className={classname} onClick={()=>signOut({
        fetchOptions:{
            onSuccess:()=>{
                router.push("/login")
            }
        }
    })}>{children}</span>
  )
}

export default Logout