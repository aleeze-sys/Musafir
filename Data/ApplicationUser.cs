using Microsoft.AspNetCore.Identity;

namespace musafir.Data
{
    public class ApplicationUser : IdentityUser
    {
        public string FullName { get; set; }
    }
}
